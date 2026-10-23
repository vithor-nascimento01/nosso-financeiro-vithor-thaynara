// Exposição SOMENTE da URL e da chave publicável do Supabase (nunca service_role).
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({error:"Método não permitido"});
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    return res.status(503).json({configured:false,error:"Conexão com o banco ainda não ativada."});
  }
  return res.status(200).json({configured:true,url,anonKey});
}
