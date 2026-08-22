// Edge Function: authenticate
// Verifies username + password (bcrypt). Gracefully migrates plain-text passwords on first login.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: 'username/email and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Accept email OR username as the identifier
    const identifier = username.trim().toLowerCase();
    const isEmail = identifier.includes('@');

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, password, display_name, email, is_active, created_at')
      .eq(isEmail ? 'email' : 'username', identifier)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine if stored password is bcrypt hash or plain text
    const isBcrypt = user.password?.startsWith('$2');
    let valid = false;

    if (isBcrypt) {
      valid = await bcrypt.compare(password, user.password);
    } else {
      // Plain text comparison (legacy); migrate to bcrypt on success
      valid = user.password === password;
      if (valid) {
        const hashed = await bcrypt.hash(password);
        await supabase.from('users').update({ password: hashed }).eq('id', user.id);
      }
    }

    if (!valid) {
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        is_active: user.is_active,
        created_at: user.created_at,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
