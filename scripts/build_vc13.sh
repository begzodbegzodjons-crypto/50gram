#!/bin/bash
# VC13 APK BUILD — «50gram.uz chiqsin» (Task 71)
# vc12 workers.dev'dan ochilardi; vc13 manbasi ALLAQACHON 50gram.uz ga o'zgartirilgan edi
# (7411f2b commit) lekin BUILD QILINGAN EMAS edi. Bu skript uni shu muhitda quradi:
# aapt2(link) + javac + d8(r8.jar) + zipalign + apksigner(50gram.keystore).
# Natija: web/50gram.apk (vc13, versionCode=13, versionName=3.3) — eskisi ustiga o'rnatiladi.
set -e
ROOT=/home/z/my-project
BT=$ROOT/apkbuild/tools/bt/android-14
JAR=$ROOT/apkbuild/tools/android34.jar
OUT=$ROOT/apkbuild/out
mkdir -p "$OUT"
cd "$OUT"
echo "== 1/7 aapt2 compile res =="
"$BT/aapt2" compile --dir "$ROOT/android/res" -o res.zip
echo "== 2/7 aapt2 link (manifest vc13) =="
"$BT/aapt2" link -o base.apk -I "$JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  --java gen --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 13 --version-name 3.3 --auto-add-overlay res.zip
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
  --out "$ROOT/apkbuild/50gram-vc13.apk" aligned.apk
"$BT/apksigner" verify --print-certs "$ROOT/apkbuild/50gram-vc13.apk" | head -5
ls -la "$ROOT/apkbuild/50gram-vc13.apk"
echo "BUILD OK"
