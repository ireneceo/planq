package app.planq;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 앱 안 플러그인은 super.onCreate 전에 등록한다(Capacitor 규약) — #434 다른 앱의 «공유» 받기
    registerPlugin(ShareReceivePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
