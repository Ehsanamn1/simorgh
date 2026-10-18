import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const plistPath = resolve(process.cwd(), 'ios/App/App/Info.plist');
if (!existsSync(plistPath)) {
  throw new Error('iOS Info.plist was not found. Run npx cap add ios and npx cap sync ios first.');
}

let plist = readFileSync(plistPath, 'utf8');
if (!plist.includes('<plist')) {
  throw new Error('iOS Info.plist is not an XML property list; refusing to edit it.');
}

const entries = [
  ['NSLocationWhenInUseUsageDescription', 'Simorgh uses your location only when you explicitly tap Send GPS for an assigned shipment.'],
  ['NSMicrophoneUsageDescription', 'مدار فقط هنگام شروع دستیار صوتی و با اجازه‌ی تو از میکروفون استفاده می‌کند.'],
  ['NSSpeechRecognitionUsageDescription', 'مدار برای تبدیل گفتار تو به متن دستورها از سرویس تشخیص گفتار دستگاه استفاده می‌کند.'],
];

for (const [key, value] of entries) {
  // All three keys are fixed Apple Info.plist identifiers (no regex metacharacters).
  if (plist.includes('<key>' + key + '</key>')) continue;
  const rootClose = plist.lastIndexOf('</dict>');
  if (rootClose < 0) throw new Error('Could not locate the root dictionary in iOS Info.plist.');
  const xmlValue = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const entry = '  <key>' + key + '</key>\n  <string>' + xmlValue + '</string>\n';
  plist = plist.slice(0, rootClose) + entry + plist.slice(rootClose);
}

writeFileSync(plistPath, plist);
console.log('Configured iOS microphone, speech recognition, and foreground location descriptions.');
