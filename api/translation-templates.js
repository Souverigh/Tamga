const {requirePaidTranslationClient}=require('../lib/translationAccess');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Используйте GET.'});
  try{
    await requirePaidTranslationClient(req,req.query?.slug);
    const {STARTER_TEMPLATES}=await import('../lib/translationTemplates.mjs');
    return res.status(200).json({templates:STARTER_TEMPLATES});
  }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'Доступ к шаблонам временно недоступен.'});}
};
