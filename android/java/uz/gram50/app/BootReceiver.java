package uz.gram50.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Telefon qayta yoqilganda xizmatni avtomatik ishga tushiradi. */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
    Intent s = new Intent(context, KeepAliveService.class);
    if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(s);
    else context.startService(s);
  }
}
