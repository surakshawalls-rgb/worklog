// Edge Function: send-push
// Triggered by a Supabase Database Webhook on INSERT to public.messages.
// Fetches the recipient's FCM device tokens and sends a push notification via FCM HTTP v1 API.
//
// Required Supabase secrets (set via: supabase secrets set KEY=value):
//   FIREBASE_SERVICE_ACCOUNT_JSON  — full service account JSON from Firebase Console
//   WEBHOOK_SECRET                 — random string; set same value as the webhook's Authorization header
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: {
    id: number;
    conversation_id: number;
    sender_id: number;
    message: string;
    created_at: string;
  };
}

// Generate a short-lived OAuth2 access token from a Firebase service account
async function getFCMAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const encodeB64url = (data: string) =>
    btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const header  = encodeB64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encodeB64url(JSON.stringify({
    iss:  sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:  'https://oauth2.googleapis.com/token',
    iat:  now,
    exp:  now + 3600,
  }));

  const signingInput = `${header}.${payload}`;

  const pemKey = sa.private_key.replace(/\\n/g, '\n');
  const keyBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(keyBody), c => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:   jwt,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token: string };
  return tokenData.access_token;
}

Deno.serve(async (req: Request) => {
  // Verify webhook secret to ensure only Supabase can call this
  const authHeader = req.headers.get('Authorization') ?? '';
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET') ?? '';
  if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!serviceAccountJson) {
    console.error('[send-push] FIREBASE_SERVICE_ACCOUNT_JSON secret is not set');
    return new Response('Server misconfiguration', { status: 500 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json() as WebhookPayload;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (payload.type !== 'INSERT' || payload.table !== 'messages') {
    return new Response('Ignored', { status: 200 });
  }

  const { conversation_id, sender_id } = payload.record;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Get conversation participants
  const { data: conv } = await supabase
    .from('conversations')
    .select('participant_1, participant_2')
    .eq('id', conversation_id)
    .single();

  if (!conv) {
    console.error('[send-push] Conversation not found:', conversation_id);
    return new Response('OK', { status: 200 });
  }

  // Determine recipient (the participant who is NOT the sender)
  const recipientId = conv.participant_1 === sender_id
    ? conv.participant_2
    : conv.participant_1;

  // Get sender display name
  const { data: sender } = await supabase
    .from('users')
    .select('display_name, username')
    .eq('id', sender_id)
    .single();

  const senderName = (sender as { display_name?: string; username: string } | null)
    ?.display_name
    ?? (sender as { username: string } | null)?.username
    ?? 'Someone';

  // Get recipient's device tokens
  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('user_id', recipientId);

  if (!tokens || tokens.length === 0) {
    // Recipient has no registered devices — nothing to do
    return new Response('OK', { status: 200 });
  }

  // Get FCM access token
  const sa: ServiceAccount = JSON.parse(serviceAccountJson);
  let accessToken: string;
  try {
    accessToken = await getFCMAccessToken(sa);
  } catch (err) {
    console.error('[send-push] Failed to get FCM access token:', err);
    return new Response('FCM auth error', { status: 500 });
  }

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  // Send to each token, collecting stale tokens to remove
  const staleTokens: string[] = [];

  await Promise.all(tokens.map(async ({ token }: { token: string }) => {
    const body = JSON.stringify({
      message: {
        token,
        notification: {
          title: senderName,
          body:  'New message',
        },
        data: {
          conversationId: String(conversation_id),
          senderId:       String(sender_id),
        },
        android: {
          priority: 'high',
          notification: {
            channel_id: 'messages',
            click_action: 'OPEN_CHAT',
          },
        },
      },
    });

    const res = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { status?: string } };
      // Mark unregistered tokens for cleanup
      if (err?.error?.status === 'UNREGISTERED' || err?.error?.status === 'INVALID_ARGUMENT') {
        staleTokens.push(token);
      } else {
        console.error('[send-push] FCM error:', err);
      }
    }
  }));

  // Clean up stale tokens
  if (staleTokens.length > 0) {
    await supabase
      .from('device_tokens')
      .delete()
      .in('token', staleTokens)
      .eq('user_id', recipientId);
  }

  return new Response('OK', { status: 200 });
});
