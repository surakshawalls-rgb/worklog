import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Content-Type":"application/json" };
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const secret = Deno.env.get("APP_SESSION_SECRET")!;
const db = createClient(url, key, { auth: { persistSession:false, autoRefreshToken:false } });

function enc(bytes: Uint8Array) { let s=""; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function dec(s: string) { s=s.replace(/-/g,"+").replace(/_/g,"/"); const b=atob(s+"=".repeat((4-s.length%4)%4)); return Uint8Array.from(b,c=>c.charCodeAt(0)); }
async function sig(s: string) {
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return enc(new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(s))));
}
async function issue(u: {id:number;username:string;role:string}) {
  const h=enc(new TextEncoder().encode(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const p=enc(new TextEncoder().encode(JSON.stringify({sub:String(u.id),username:u.username,role:u.role,exp:Math.floor(Date.now()/1000)+28800})));
  const s=h+"."+p; return s+"."+await sig(s);
}
async function verify(t:string) {
  const a=t.split("."); if(a.length!==3) return null;
  const expected=dec(await sig(a[0]+"."+a[1])), actual=dec(a[2]);
  if(expected.length!==actual.length) return null;
  let diff=0; for(let i=0;i<expected.length;i++) diff|=expected[i]^actual[i];
  if(diff) return null;
  const p=JSON.parse(new TextDecoder().decode(dec(a[1])));
  return p.exp>Math.floor(Date.now()/1000)&&p.sub?p:null;
}
Deno.serve(async req => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:cors});
  try {
    if(!url||!key||!secret||secret.length<32) throw new Error("Server secrets are not configured.");
    const b=await req.json();
    if(b.action==="login") {
      const identifier=String(b.username??"").trim().toLowerCase(), password=String(b.password??"");
      if(!identifier||!password||password.length>1024) return new Response(JSON.stringify({error:"Invalid username or password."}),{status:401,headers:cors});
      let q=await db.from("users").select("id,username,password,display_name,role,is_active").eq("username",identifier).maybeSingle();
      if(!q.data&&!q.error) q=await db.from("users").select("id,username,password,display_name,role,is_active").ilike("email",identifier).maybeSingle();
      const u=q.data;
      if(q.error||!u||!u.is_active||!u.password?.startsWith("$2")||!(await bcrypt.compare(password,u.password)))
        return new Response(JSON.stringify({error:"Invalid username or password."}),{status:401,headers:cors});
      const user={id:Number(u.id),username:String(u.username),name:String(u.display_name||u.username),role:u.role==="admin"?"admin":"employee"};
      return new Response(JSON.stringify({user,token:await issue(user)}),{headers:cors});
    }
    if(b.action==="transactions") {
      const a=req.headers.get("authorization")||"", token=a.startsWith("Bearer ")?a.slice(7):"";
      const session=token?await verify(token):null;
      if(!session||session.role!=="admin") return new Response(JSON.stringify({error:"Unauthorized."}),{status:401,headers:cors});
      const id=Number(b.partner_id);
      if(!Number.isSafeInteger(id)||id<=0) return new Response(JSON.stringify({error:"Invalid partner ID."}),{status:400,headers:cors});
      const {data,error}=await db.from("partner_finance_transactions").select("*").eq("partner_id",id).order("transaction_date",{ascending:false}).order("created_at",{ascending:false});
      if(error) throw error;
      return new Response(JSON.stringify({data:data||[]}),{headers:cors});
    }
    return new Response(JSON.stringify({error:"Unsupported action."}),{status:400,headers:cors});
  } catch(e) {
    console.error("partner-finance-passbook:",e);
    return new Response(JSON.stringify({error:"Request could not be completed."}),{status:500,headers:cors});
  }
});
