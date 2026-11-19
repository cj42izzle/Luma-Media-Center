package io.github.cj42izzle.luma;

import android.net.Uri;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;
import java.util.zip.GZIPInputStream;

/**
 * Protected HTTP IPTV playlist/EPG reader for Luma's native Android shell.
 * Never bypasses DRM, never proxies media via a third party and never logs URLs.
 * Source URLs are authorized by the user and remain on this device.
 */
public final class NativeIPTVBridge {
    private final TvActivity activity;
    private final String token;
    // Provider APIs often request live channels, categories and guide concurrently.
    // Queue them instead of rejecting valid requests when three connections are busy.
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(
            3, 3, 30, TimeUnit.SECONDS, new LinkedBlockingQueue<>(36),
            runnable -> { Thread thread = new Thread(runnable, "Luma-IPTV-Reader");
                thread.setDaemon(true); return thread; });
    private static final int MAX_BYTES=25 * 1024 * 1024;

    NativeIPTVBridge(TvActivity activity, String token){
        this.activity=activity;this.token=token;
    }

    private boolean authorized(String key){
        return activity.isTrustedPage()&&key!=null
                &&MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8),
                     token.getBytes(StandardCharsets.UTF_8));
    }

    @JavascriptInterface public void fetchText(String key,String id,String raw,int limit){
        if(!authorized(key))return;
        if(id==null||!id.matches("[a-zA-Z0-9]{1,90}"))return;
        final int max=Math.max(1024,Math.min(MAX_BYTES,limit));
        try{
            worker.execute(()->{
                try{respond(id,read(raw,max),null);}
                catch(SafeFeedError error){respond(id,null,error.getMessage());}
                catch(java.net.SocketTimeoutException error){
                    respond(id,null,"The IPTV provider timed out while loading channels or guide data. Retry or check your service.");
                }
                catch(java.net.UnknownHostException error){
                    respond(id,null,"The IPTV server address could not be resolved on this Android TV.");
                }
                catch(Exception error){
                    // Never echo provider URLs or credentials from Java exception messages.
                    respond(id,null,"Could not read the IPTV server from this Android TV. Check the provider address, login and network.");
                }
            });
        }catch(RejectedExecutionException busy){
            respond(id,null,"Too many IPTV sources are loading at once; retry after the current requests finish");
        }
    }

    private static final class SafeFeedError extends Exception {
        SafeFeedError(String reason){super(reason);}
    }

    void shutdown(){worker.shutdownNow();}

    private static URI checked(String raw) throws Exception {
        if(raw==null||raw.length()>6000)throw new IllegalArgumentException();
        URI uri=new URI(raw);
        String scheme=uri.getScheme();
        String host=uri.getHost();
        if(scheme==null||!(scheme.equalsIgnoreCase("http")||scheme.equalsIgnoreCase("https"))
                ||host==null||host.isEmpty()||uri.getRawUserInfo()!=null)
            throw new IllegalArgumentException();
        if(uri.getPort()>65535)throw new IllegalArgumentException();
        for(InetAddress address:InetAddress.getAllByName(host)){
            if(address.isAnyLocalAddress()||address.isLoopbackAddress()
                    ||address.isLinkLocalAddress()||address.isSiteLocalAddress()
                    ||address.isMulticastAddress())throw new IllegalArgumentException();
            byte[] ip=address.getAddress();
            // IPv6 unique-local fc00::/7 is not always classified as site-local.
            if(ip.length==16&&(ip[0]&0xFE)==0xFC)throw new IllegalArgumentException();
        }
        return uri;
    }

    private static String read(String raw,int limit) throws Exception {
        URI uri=checked(raw);
        String initialHost=uri.getHost();
        for(int redirect=0;redirect<3;redirect++){
            HttpURLConnection conn=(HttpURLConnection)new URL(uri.toString()).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(14000);conn.setReadTimeout(23000);
            conn.setRequestProperty("User-Agent","LumaNativeIPTV/1.0");
            conn.setRequestProperty("Accept-Encoding","gzip");
            try{
                int code=conn.getResponseCode();
                if(code==301||code==302||code==303||code==307||code==308){
                    String location=conn.getHeaderField("Location");
                    if(location==null)throw new IllegalArgumentException();
                    URI next=checked(uri.resolve(location).toString());
                    // Never forward Xtream credentials to a different host via redirects.
                    if(!initialHost.equalsIgnoreCase(next.getHost()))throw new SafeFeedError("The IPTV provider redirects channel requests to a different host. Use the provider's direct server address.");
                    uri=next;
                    continue;
                }
                if(code==401||code==403)
                    throw new SafeFeedError("IPTV provider denied the channel request (HTTP "+code+"). Check your login and account permissions.");
                if(code==404)throw new SafeFeedError("IPTV provider endpoint not found (HTTP 404). Check the exact Xtream server path and port.");
                if(code==429)throw new SafeFeedError("IPTV provider rate limit reached (HTTP 429). Retry after the provider allows more requests.");
                if(code<200||code>=300)
                    throw new SafeFeedError("IPTV provider returned HTTP "+code+" while loading channels or guide data.");
                InputStream stream=conn.getInputStream();
                if("gzip".equalsIgnoreCase(conn.getContentEncoding()))
                    stream=new GZIPInputStream(stream);
                try(InputStream input=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int length;
                    while((length=input.read(buffer))!=-1){
                        if(out.size()+length>limit)throw new SafeFeedError("This IPTV feed exceeds Luma's maximum response size. Ask the provider for a smaller guide or channel feed.");
                        out.write(buffer,0,length);
                    }
                    String text=new String(out.toByteArray(),StandardCharsets.UTF_8);
                    return text.startsWith("\uFEFF")?text.substring(1):text;
                }
            }finally{conn.disconnect();}
        }
        throw new IllegalArgumentException();
    }

    private void respond(String id,String content,String error){
        if(error==null){
            activity.deliverIPTVText(id,content==null?"":content);
            return;
        }
        try{
            JSONObject data=new JSONObject().put("id",id).put("error",error);
            activity.deliverIPTVResponse(data.toString());
        }catch(Exception ignored){}
    }
}
