import chalk from 'chalk';
import { generateVibePage } from './core.js';

generateVibePage('生成一个捕捉日常生活浪漫瞬间的页面', {
  log: (msg) => console.log(chalk.dim(msg)),
});
