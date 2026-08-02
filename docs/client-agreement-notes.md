# What this platform does and does not guarantee

A one-pager for the business owner. Keep this framing intact — it is a deliberate liability boundary
(`architecture.md §17.4`), and the honest version is what makes the product defensible.

---

## English

**What we assert.** When we mark an order verified, we are asserting exactly this:

> _A payment-confirmation SMS consistent with this order was received on the phone you registered._

**What we do not assert.** We are **not** a payment processor. We never touch, hold, or move your money.
We do not confirm that funds settled in your account, and we cannot reverse, refund, or dispute a
payment. Your own reconciliation against your bKash statement remains your responsibility.

**How verification works.** Your website tells us an order is pending. Your phone reads the payment SMS
from bKash. We match them — by transaction ID when you collect one, otherwise by amount, time and sender.
When they match, we tell your website.

**Where it can be wrong.**

- If your phone is off, uncharged, or has SMS permission revoked, payments are captured late or not at
  all until it is fixed. The app tells you; so does our dashboard.
- If you do not collect a transaction ID or the customer's number, two customers paying the same amount
  within the same window are genuinely ambiguous. We send those to manual review rather than guess —
  which means a delay, not a wrong answer.
- If a customer sends money without your website creating an order, there is nothing to match it to.
- We never auto-verify an underpayment. An overpayment verifies, flagged.

**Your responsibilities.** Keep the phone on, charged, connected, and with the app permitted to run in
the background. Reconcile your own statement. Tell us promptly if anything looks wrong.

---

## বাংলা

**আমরা যা নিশ্চিত করি।** আমরা যখন একটি অর্ডার "যাচাই হয়েছে" বলি, তখন আমরা ঠিক এইটুকুই বলছি:

> _আপনার নিবন্ধিত ফোনে এই অর্ডারের সাথে সঙ্গতিপূর্ণ একটি পেমেন্ট-নিশ্চিতকরণ এসএমএস এসেছে।_

**আমরা যা নিশ্চিত করি না।** আমরা পেমেন্ট প্রসেসর নই। আমরা আপনার টাকা কখনো স্পর্শ করি না, রাখি না, বা
স্থানান্তর করি না। টাকা আপনার অ্যাকাউন্টে চূড়ান্তভাবে জমা হয়েছে কিনা তা আমরা নিশ্চিত করি না, এবং কোনো
পেমেন্ট ফেরত বা বাতিল করতে পারি না। আপনার বিকাশ স্টেটমেন্টের সাথে হিসাব মেলানোর দায়িত্ব আপনারই।

**যাচাই কীভাবে কাজ করে।** আপনার ওয়েবসাইট আমাদের জানায় একটি অর্ডার অপেক্ষমাণ। আপনার ফোন বিকাশের পেমেন্ট
এসএমএস পড়ে। আমরা দুটি মিলিয়ে দেখি — ট্রানজেকশন আইডি থাকলে সেটি দিয়ে, নাহলে পরিমাণ, সময় ও প্রেরক দিয়ে।
মিলে গেলে আমরা আপনার ওয়েবসাইটকে জানাই।

**কোথায় ভুল হতে পারে।**

- ফোন বন্ধ থাকলে, চার্জ না থাকলে, বা এসএমএস অনুমতি বন্ধ থাকলে পেমেন্ট দেরিতে ধরা পড়ে বা ধরা পড়ে না।
  অ্যাপ ও আমাদের ড্যাশবোর্ড উভয়ই আপনাকে জানাবে।
- ট্রানজেকশন আইডি বা গ্রাহকের নম্বর না নিলে, একই সময়ে একই পরিমাণ পাঠানো দুজন গ্রাহকের ক্ষেত্রে বিষয়টি
  সত্যিই অস্পষ্ট। আমরা অনুমান না করে সেগুলো ম্যানুয়াল রিভিউতে পাঠাই — অর্থাৎ দেরি হয়, ভুল হয় না।
- ওয়েবসাইটে অর্ডার তৈরি না করে কেউ টাকা পাঠালে মেলানোর মতো কিছু থাকে না।
- কম টাকা এলে আমরা কখনোই স্বয়ংক্রিয়ভাবে যাচাই করি না। বেশি টাকা এলে যাচাই হয়, চিহ্নসহ।

**আপনার দায়িত্ব।** ফোন চালু, চার্জযুক্ত ও ইন্টারনেটে যুক্ত রাখুন এবং অ্যাপটিকে ব্যাকগ্রাউন্ডে চলার
অনুমতি দিন। নিজের স্টেটমেন্ট মিলিয়ে দেখুন। কিছু অস্বাভাবিক মনে হলে দ্রুত আমাদের জানান।
