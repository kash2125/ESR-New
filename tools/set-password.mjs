import { hashPassword } from '../src/auth.js';
if(!process.stdin.isTTY) {
  let input='';for await(const chunk of process.stdin)input+=chunk;
  console.log(await hashPassword(input.replace(/[\r\n]+$/,'')));
} else {
  process.stdout.write('Enter the staff password (input is hidden):\n');
  process.stdin.setRawMode(true);process.stdin.resume();
  let input='';
  process.stdin.on('data',async chunk=>{
    for(const char of chunk.toString()) {
      if(char==='\u0003'){process.exit(1);}
      if(char==='\r' || char==='\n'){
        process.stdin.setRawMode(false);process.stdin.pause();
        console.log(await hashPassword(input));input='';process.exit(0);
      } else if(char==='\u007f' || char==='\b'){input=input.slice(0,-1);}
      else {input+=char;}
    }
  });
}
