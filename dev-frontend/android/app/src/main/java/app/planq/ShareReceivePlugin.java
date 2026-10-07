package app.planq;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * 다른 앱의 «공유» → PlanQ (#434 ② 안드로이드). 설계 docs/NATIVE_SHARE_RECEIVE.md
 *
 * 여기서는 받은 파일을 앱 캐시 폴더로 **복사만** 한다. 화면·저장 위치 고르기는 웹 공유(PWA share_target)와
 * 같은 /share-receive 화면이 한다 — JS(services/nativeShare.ts)가 이 결과를 웹 공유와 같은 캐시 형식으로 옮긴다.
 * 네이티브 전용 화면을 따로 만들면 웹과 앱의 선택지가 갈라진다.
 *
 * 흐름: 콜드 스타트 = load() 가 시작 인텐트를 읽는다 / 켜져 있을 때 = handleOnNewIntent.
 *      둘 다 pending 에 담고 "shareReceived" 신호만 보낸다 — JS 는 신호를 받거나 시작할 때 takePending() 으로 가져간다
 *      (신호를 보관(retain)하면 시작 때 takePending 과 겹쳐 두 번 처리된다).
 */
@CapacitorPlugin(name = "ShareReceive")
public class ShareReceivePlugin extends Plugin {
  // 웹 공유 화면이 받는 파일 크기와 맞춘다 — 요금제 최대 파일 50MB. 넘는 것은 건너뛰고 수를 알린다.
  private static final long MAX_FILE_BYTES = 50L * 1024 * 1024;
  private static final long MAX_TOTAL_BYTES = 100L * 1024 * 1024;
  private static final int MAX_FILES = 10;

  private JSObject pending = null;

  @Override
  public void load() {
    Intent intent = getActivity().getIntent();
    if (handle(intent)) {
      // 화면 회전 등으로 액티비티가 다시 만들어질 때 같은 공유를 두 번 받지 않게 비운다
      getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
    }
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    handle(intent);
  }

  @PluginMethod
  public void takePending(PluginCall call) {
    JSObject out;
    synchronized (this) {
      out = pending != null ? pending : new JSObject();
      pending = null;
    }
    call.resolve(out);
  }

  private boolean handle(Intent intent) {
    if (intent == null) return false;
    String action = intent.getAction();
    if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;

    ArrayList<Uri> uris = new ArrayList<>();
    if (Intent.ACTION_SEND.equals(action)) {
      Uri u = Build.VERSION.SDK_INT >= 33
        ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
        : intent.getParcelableExtra(Intent.EXTRA_STREAM);
      if (u != null) uris.add(u);
    } else {
      ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
        ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
        : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
      if (list != null) uris.addAll(list);
    }

    File dir = new File(getContext().getCacheDir(), "share-in");
    // 지난 공유의 남은 파일은 지운다 — 앱 캐시에 쌓이지 않게
    File[] old = dir.listFiles();
    if (old != null) for (File f : old) f.delete();
    dir.mkdirs();

    JSArray files = new JSArray();
    int skipped = 0;
    long total = 0;
    for (int i = 0; i < uris.size(); i++) {
      Uri uri = uris.get(i);
      if (files.length() >= MAX_FILES) { skipped++; continue; }
      String name = displayName(uri);
      if (name == null || name.isEmpty()) name = "shared-" + (i + 1);
      String safe = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_");
      File out = new File(dir, i + "-" + safe);
      long size = copy(uri, out, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total));
      if (size < 0) { out.delete(); skipped++; continue; }
      total += size;
      String mime = getContext().getContentResolver().getType(uri);
      JSObject f = new JSObject();
      f.put("path", out.getAbsolutePath());
      f.put("name", name);
      f.put("mime", mime != null ? mime : "application/octet-stream");
      f.put("size", size);
      files.put(f);
    }

    JSObject payload = new JSObject();
    String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
    payload.put("title", subject != null ? subject : "");
    payload.put("text", text != null ? text.toString() : "");
    payload.put("files", files);
    payload.put("skipped", skipped);
    payload.put("ts", System.currentTimeMillis());
    synchronized (this) { pending = payload; }
    notifyListeners("shareReceived", new JSObject());
    return true;
  }

  private String displayName(Uri uri) {
    try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) {
        int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
        if (idx >= 0) return c.getString(idx);
      }
    } catch (Exception ignored) { /* 이름 없이 진행 */ }
    String last = uri.getLastPathSegment();
    return last;
  }

  /** 복사한 바이트 수. 한도를 넘거나 실패하면 -1. */
  private long copy(Uri uri, File out, long limit) {
    if (limit <= 0) return -1;
    try (InputStream in = getContext().getContentResolver().openInputStream(uri);
         OutputStream os = new FileOutputStream(out)) {
      if (in == null) return -1;
      byte[] buf = new byte[64 * 1024];
      long n = 0;
      int r;
      while ((r = in.read(buf)) != -1) {
        n += r;
        if (n > limit) return -1;
        os.write(buf, 0, r);
      }
      return n;
    } catch (Exception e) {
      return -1;
    }
  }
}
