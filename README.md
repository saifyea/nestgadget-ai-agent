# NestGadget BD — AI Sales Agent

USB-C অ্যাডাপ্টার প্রোডাক্টের জন্য Messenger-ভিত্তিক AI সেলস এজেন্ট। কাস্টমার ইনবক্সে মেসেজ দিলে Claude API ব্যবহার করে বাংলায় স্বয়ংক্রিয় উত্তর দেয় (দাম, ফিচার, ডেলিভারি, COD ইত্যাদি)।

## ১. প্রোডাক্ট তথ্য বসাও
`product-knowledge.json` ফাইল খুলে নিজের দাম, ফিচার, ডেলিভারি চার্জ ও ওয়ারেন্টি তথ্য বসাও।

## ২. Environment ভ্যারিয়েবল সেট করো
`.env.example` ফাইলটা কপি করে `.env` নামে সেভ করো, তারপর তিনটা মান বসাও:
- `FB_PAGE_ACCESS_TOKEN` — Meta App → Messenger সেটিংস থেকে
- `FB_VERIFY_TOKEN` — যেকোনো একটা নিজের বানানো গোপন স্ট্রিং (Facebook-এ পরে একই স্ট্রিং বসাতে হবে)
- `ANTHROPIC_API_KEY` — console.anthropic.com থেকে

## ৩. লোকালি চালিয়ে দেখো (ঐচ্ছিক)
```
npm install
npm start
```

## ৪. ডিপ্লয় করো
এই ফোল্ডারটা GitHub-এ পুশ করে Render.com বা Railway.app-এ কানেক্ট করো। ডিপ্লয় সেটিংসে Environment Variables ট্যাবে `.env`-এর তিনটা মান বসিয়ে দাও। ডিপ্লয় সফল হলে একটা পাবলিক URL পাবে।

## ৫. Facebook-এ Webhook কনফিগার করো
Meta App → Messenger → Webhooks-এ গিয়ে:
- Callback URL: `https://তোমার-ডোমেইন/webhook`
- Verify Token: `.env`-এ যা বসিয়েছ ঠিক তাই
- Subscribe to: `messages`

## ৬. টেস্ট করো
পেজে নিজে একটা মেসেজ পাঠিয়ে দেখো এজেন্ট বাংলায় রিপ্লাই দিচ্ছে কিনা। ঠিকঠাক কাজ করলে বুস্ট করা অ্যাডে Messenger objective চালু করো।

## পরবর্তী উন্নতির জায়গা
- এখন কনভারসেশন সার্ভার রিস্টার্ট হলে মুছে যায় — বড় স্কেলে গেলে একটা ডাটাবেস (SQLite/Postgres) যোগ করো
- জটিল/অভিযোগমূলক মেসেজ কোনো এক Messenger গ্রুপ/ইমেইলে ফরোয়ার্ড করার লজিক যোগ করা যায় (human handoff)
- একাধিক প্রোডাক্ট হলে `product-knowledge.json`-কে অ্যারে করে দেওয়া যায়
