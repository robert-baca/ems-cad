package com.sfotems.crew;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTrackerPlugin.class);
        super.onCreate(savedInstanceState);
        // Prevent screen timeout while app is in foreground (crew vehicle use)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep WebView JS running after screen turns off so socket/UI updates continue
        bridge.getWebView().onResume();
    }
}
