// Edge Function: forgot-password
// Generates a secure reset token, stores its SHA-256 hash in DB, and sends reset email via Resend.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:4200';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'noreply@syncpoint.app';

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: user } = await supabase
      .from('users')
      .select('id, display_name, email')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle();

    // Always return success to prevent email enumeration
    if (!user) {
      return new Response(
        JSON.stringify({ message: 'If that email exists, a reset link has been sent.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Invalidate previous tokens for this user
    await supabase
      .from('password_reset_tokens')
      .update({ used: true })
      .eq('user_id', user.id)
      .eq('used', false);

    const rawToken = generateToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await supabase.from('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`;

    // Send email via Resend
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: user.email,
        subject: 'Reset your SyncPoint password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;">
            <h2>Password Reset</h2>
            <p>Hi ${user.display_name ?? 'there'},</p>
            <p>You requested to reset your SyncPoint password. Click the button below — this link expires in <strong>1 hour</strong>.</p>
            <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563EB;color:white;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
            <p style="margin-top:24px;font-size:12px;color:#6b7280;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
            <p style="font-size:12px;color:#6b7280;">Or copy this link: ${resetUrl}</p>
          </div>
        `,
      }),
    });

    return new Response(
      JSON.stringify({ message: 'If that email exists, a reset link has been sent.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
