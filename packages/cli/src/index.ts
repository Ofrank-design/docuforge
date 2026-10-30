#!/usr/bin/env node
import { run } from "./cli.js";

run(process.argv.slice(2), { cwd: process.cwd() }).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 70;
  },
);
