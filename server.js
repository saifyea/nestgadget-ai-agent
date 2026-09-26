require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORDER_WEBHOOK_URL = process.env.ORDER_WEBHOOK_URL;

const productKnowledge = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'product-knowledge.json'), 'utf8')
);

// Simple in-memory conversation history per Messenger user.
// Resets when the server restarts — fine for a small launch, swap for a
// real database (e.g. SQLite/Postgres) once volume grows.
const conversations = {};

// --- Webhook verification (Facebook calls this once, with GET) ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// --- Incoming messages (Facebook calls this with POST) ---
app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('POST /webhook received:', JSON.stringify(body));

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        console.log(`Message from ${senderId}: ${webhookEvent.message.text}`);
        // Don't await here — Facebook expects a fast 200 response.
        handleUserMessage(senderId, webhookEvent.message.text).catch((err) =>
          console.error('handleUserMessage error:', err.message)
        );
      } else {
        console.log('Event received but no message.text field:', JSON.stringify(webhookEvent));
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    console.log('Ignored non-page event:', JSON.stringify(body));
    res.sendStatus(404);
  }
});

async function handleUserMessage(senderId, userText) {
  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }
  conversations[senderId].push({ role: 'user', content: userText });

  // Keep only the last 10 turns to control token cost.
  const history = conversations[senderId].slice(-10);

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: buildSystemPrompt(),
        messages: history,
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    let replyText = response.data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const wantsPhoto = replyText.includes('[PHOTO]');
    replyText = replyText.replace('[PHOTO]', '').trim();

    const orderMatch = replyText.match(/\[ORDER_DATA\]([\s\S]*?)\[\/ORDER_DATA\]/);
    if (orderMatch) {
      replyText = replyText.replace(orderMatch[0], '').trim();
      const fields = {};
      orderMatch[1].split('\n').forEach((line) => {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) {
          fields[key.trim().toLowerCase()] = rest.join(':').trim();
        }
      });
      saveOrder(senderId, fields).catch((err) =>
        console.error('Order webhook error:', err.response?.data || err.message)
      );
    }

    console.log(`AI reply for ${senderId}: ${replyText} (photo: ${wantsPhoto}, order: ${!!orderMatch})`);
    conversations[senderId].push({ role: 'assistant', content: replyText });
    await sendMessengerMessage(senderId, replyText);

    if (wantsPhoto && Array.isArray(productKnowledge.photo_urls)) {
      for (const url of productKnowledge.photo_urls) {
        if (url && url.startsWith('http')) {
          await sendMessengerImage(senderId, url);
        }
      }
    }

    console.log(`Sent to Messenger successfully for ${senderId}`);
  } catch (err) {
    console.error('AI or send error:', err.response?.data || err.message);
    await sendMessengerMessage(
      senderId,
      'দুঃখিত, এই মুহূর্তে উত্তর দিতে একটু সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন।'
    );
  }
}

function buildSystemPrompt() {
  return `তুমি ${productKnowledge.brand}-এর একজন বন্ধুত্বপূর্ণ সেলস এজেন্ট। সবসময় বাংলায়, আন্তরিকভাবে উত্তর দাও।

প্রোডাক্ট তথ্য (JSON):
${JSON.stringify(productKnowledge, null, 2)}

নিয়ম:
- কাস্টমার অর্ডার করতে চাইলে নাম, ফোন নম্বর ও ঠিকানা চেয়ে নাও
- এই তিনটা তথ্যই (নাম, ফোন, ঠিকানা) পাওয়ার পর, স্বাভাবিক কনফার্মেশন রিপ্লাইয়ের একদম শেষে নতুন লাইনে ঠিক এই ফরম্যাটে একটা ব্লক যোগ করো (কাস্টমার এটা দেখবে না, এটা সিস্টেমের জন্য):
[ORDER_DATA]
name: <নাম>
phone: <ফোন নম্বর>
address: <ঠিকানা>
[/ORDER_DATA]
এই ব্লক শুধু একবারই দাও, ঠিক যখন তিনটা তথ্যই কনফার্ম হয়েছে — এর আগে বা প্রতি মেসেজে দিও না
- কাস্টমার প্রোডাক্টের ছবি/ফটো দেখতে চাইলে, তোমার রিপ্লাই টেক্সটের একদম শেষে নতুন লাইনে ঠিক এই ট্যাগটা লিখো: [PHOTO] (এই ট্যাগ কাস্টমার দেখবে না, এটা শুধু সিস্টেমের জন্য একটা সংকেত)
- নিচের "faq" লিস্টে যদি কাস্টমারের প্রশ্নের কাছাকাছি কোনো প্রশ্ন থাকে, তাহলে সেই নির্দিষ্ট answer-টাই ব্যবহার করো (নিজের ভাষায় সামান্য মানিয়ে বলতে পারো, কিন্তু মূল বক্তব্য বদলো না)
- faq-তে না থাকলে product তথ্য থেকে উত্তর বানাও
- কেউ প্রথমবার শুধু "হাই/হ্যালো/শুরু করি" টাইপ মেসেজ দিলে "greeting" টেক্সট দিয়ে শুরু করো
- কখনো মার্কডাউন ফরম্যাটিং ব্যবহার কোরো না (যেমন **বোল্ড**, ~~স্ট্রাইকথ্রু~~, # হেডিং) — Messenger এগুলো রেন্ডার করে না, শুধু সাধারণ প্লেইন টেক্সট লেখো
- দাম, ফিচার, ডেলিভারি সংক্রান্ত প্রশ্নের উত্তর শুধু উপরের তথ্য থেকে দাও, নিজে থেকে বানিয়ে বোলো না
- COD (Cash on Delivery) অফার করা হয় — প্রাসঙ্গিক হলে উল্লেখ করো
- কাস্টমার অর্ডার করতে চাইলে নাম, ফোন নম্বর ও ঠিকানা চেয়ে নাও
- রিফান্ড, অভিযোগ, বা জটিল সমস্যার ক্ষেত্রে বলো একজন টিম মেম্বার শীঘ্রই যোগাযোগ করবে
- উত্তর সংক্ষিপ্ত রাখো (২-৪ বাক্য), মাঝেমধ্যে ইমোজি ব্যবহার করতে পারো
- যা জানো না তা নিয়ে অনুমান করে বলো না`;
}

async function sendMessengerMessage(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text },
    }
  );
}

async function sendMessengerImage(senderId, imageUrl) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true },
        },
      },
    }
  );
}

async function saveOrder(senderId, fields) {
  if (!ORDER_WEBHOOK_URL) {
    console.log('ORDER_WEBHOOK_URL not set — skipping order save. Fields were:', fields);
    return;
  }
  await axios.post(ORDER_WEBHOOK_URL, {
    senderId,
    name: fields.name || '',
    phone: fields.phone || '',
    address: fields.address || '',
    product: productKnowledge.product_name,
  });
  console.log(`Order saved for ${senderId}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
