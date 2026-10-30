// Node client for dds_server.py (endplay/DDS). EXPLORATORY tier.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export class DDS {
  constructor(python = process.env.DDS_PYTHON || 'python3') {
    this.proc = spawn(python, [join(here, 'dds_server.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.queue = [];
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      const p = this.queue.shift();
      if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.res);
    });
  }
  call(req) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }
  close() { this.proc.stdin.end(); }
}
