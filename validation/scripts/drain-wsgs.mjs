import {Pool} from 'pg';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
const started=Date.now();
try{
 const initial=await pool.query("SELECT count(*)::int AS count, max(deadline_at) AS deadline FROM wsgs.grounding_job WHERE status IN ('ACCEPTED','RUNNING')");
 const cutoff=Math.max(started,new Date(initial.rows[0].deadline??started).getTime())+60000;
 while(true){
  const {rows}=await pool.query("SELECT count(*)::int AS count FROM wsgs.grounding_job WHERE status IN ('ACCEPTED','RUNNING')");
  if(rows[0].count===0)break;
  if(Date.now()>cutoff)throw Error('UPGRADE_DRAIN_INCOMPLETE');
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 console.log(JSON.stringify({status:'DRAINED',initialJobs:initial.rows[0].count,elapsedMs:Date.now()-started}));
}finally{await pool.end();}
