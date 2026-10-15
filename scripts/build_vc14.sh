#!/bin/bash
# VC14 APK BUILD — «SESSIYA O'LMAZ» (v131, Task 77)
# vc14 yangilik: Bridge.getSavedToken() — sahifa APK yangilanishida (origin o'zgarsa ham)
# native SharedPreferences'dagi tokenni so'rab sessiyani JIM tiklaydi (qayta ro'yxatdan
# o'tish YO'Q). Manba tayyor: android/AndroidManifest.xml (versionCode=14) + MainActivity.java.
# Bu skript build_vc13.sh bilan BIR XIL zanjir — faqat vc14/3.4 nomlari bilan.
# Talab: apkbuild/tools/ (aapt2, d8.jar, ecj.jar, android34.jar, zipalign, apksigner) —
# shu muhitda mavjud bo'lgan mashinada ishga tushiring (qurish bu muhitda uchramagan).
set -e
ROOT=/home/z/my-project
BT=$ROOT/apkbuild/tools/bt/android-14
JAR=$ROOT/apkbuild/tools/android34.jar
OUT=$ROOT/apkbuild/out
mkdir -p "$OUT"
cd "$OUT"
echo "== 1/7 aapt2 compile res =="
"$BT/aapt2" compile --dir "$ROOT/android/res" -o res.zip
echo "== 2/7 aapt2 link (manifest vc14) =="
"$BT/aapt2" link -o base.apk -I "$JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  --java gen --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 14 --version-name 3.4 --auto-add-overlay res.zip
echo "== 3/7 javac (ECJ) =="
rm -rf classes gen-classes; mkdir -p classes
java -jar "$ROOT/apkbuild/tools/ecj.jar" -source 8 -target 8 -nowarn -proc:none \
  -bootclasspath "$JAR" -classpath "$JAR" \
  -d classes "$ROOT"/android/java/uz/gram50/app/*.java gen/uz/gram50/app/R.java 2>&1 | grep -viE "warning|bootstrap|deprecat|^\d+\. " || true
[ -f classes/uz/gram50/app/MainActivity.class ] || { echo "JAVAC XATO"; exit 1; }
echo "== 4/7 d8 (dex) =="
rm -rf dexout; mkdir -p dexout
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$JAR" \
  --output dexout $(find classes -name '*.class')
[ -f dexout/classes.dex ] || { echo "D8 XATO"; exit 1; }
echo "== 5/7 classes.dex → apk =="
cp base.apk unsigned.apk
(cd dexout && zip -q -j ../unsigned.apk classes.dex)
echo "== 6/7 zipalign =="
"$BT/zipalign" -f 4 unsigned.apk aligned.apk
echo "== 7/7 apksigner (50gram.keystore) =="
"$BT/apksigner" sign --ks "$ROOT/android/50gram.keystore" \
  --ks-pass pass:50gram2026 --ks-key-alias 50gram \
  --out "$ROOT/apkbuild/50gram-vc14.apk" aligned.apk
echo "== TAYYOR: $ROOT/apkbuild/50gram-vc14.apk"
echo "Joylash: cp $ROOT/apkbuild/50gram-vc14.apk $ROOT/web/50gram.apk  (keyin git push — deploy)"
