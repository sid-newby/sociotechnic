#!/bin/sh
# Scope every record write to this dispatch output directory, including symlink checks.
node -e '
const fs=require("node:fs"),p=require("node:path");let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
 try{const j=JSON.parse(s),raw=j?.tool_input?.file_path,root=process.env.SOCIOTECHNIC_OUTPUT_ROOT;
 if(typeof raw!=="string"||!root)throw Error("Missing dispatch write scope");
 const target=p.resolve(j.cwd||process.cwd(),raw),boundary=p.resolve(root);
 if(!target.startsWith(boundary+p.sep))throw Error("Output escapes dispatch");
 let cursor=boundary;for(const bit of p.relative(boundary,target).split(p.sep)){cursor=p.join(cursor,bit);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error("Symlinked output");}
 if(fs.lstatSync(boundary).isSymbolicLink())throw Error("Symlinked output root");
 }catch(e){process.stderr.write("sociotechnic: "+e.message+"\n");process.exitCode=2;}
});'
