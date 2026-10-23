// Versão pública do código publicado na Vercel.
// Não consulta dados financeiros nem expõe variáveis sigilosas.
export default function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({error:'Método não permitido'});
  const version=
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_URL ||
    null;
  if(!version)return res.status(503).json({version:null});
  return res.status(200).json({version});
}
