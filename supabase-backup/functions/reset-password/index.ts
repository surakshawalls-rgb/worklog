// Edge Function: reset-password
// Validates reset token (SHA-256 hash match + expiry), then updates password with bcrypt hash.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { token, new_password } = await req.json();

    if (!token || !new_password) {
      return new Response(
        JSON.stringify({ error: 'token and new_password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new_password.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const tokenHash = await sha256Hex(token);

    const { data: record } = await supabase
      .from('password_reset_tokens')
      .select('id, user_id, expires_at, used')
      .eq('token_hash', tokenHash)
      .eq('used', false)
      .maybeSingle();

    if (!record) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired reset link' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new Date(record.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Reset link has expired. Please request a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const passwordHash = await bcrypt.hash(new_password);

    // Update password and mark token as used in parallel
    await Promise.all([
      supabase.from('users').update({ password: passwordHash }).eq('id', record.user_id),
      supabase.from('password_reset_tokens').update({ used: true }).eq('id', record.id),
    ]);

    return new Response(
      JSON.stringify({ message: 'Password updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
