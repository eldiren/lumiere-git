import Prism from "./prism-global";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-scala";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-php";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-haskell";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-glsl";
import "prismjs/components/prism-cmake";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-nginx";
import "prismjs/components/prism-hcl";

const BY_EXT: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  svelte: "markup",
  vue: "markup",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  plist: "markup",
  css: "css",
  scss: "scss",
  less: "scss",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  ino: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  go: "go",
  rs: "rust",
  swift: "swift",
  dart: "dart",
  py: "python",
  pyw: "python",
  pyi: "python",
  rb: "ruby",
  php: "php",
  lua: "lua",
  hs: "haskell",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  psm1: "powershell",
  json: "json",
  jsonc: "json",
  json5: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  glsl: "glsl",
  vert: "glsl",
  frag: "glsl",
  vex: "c",
  vfl: "c",
  cmake: "cmake",
  mk: "makefile",
  tf: "hcl",
  hcl: "hcl",
  usda: "python",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  "nginx.conf": "nginx",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
};

export function languageFor(path: string): string | null {
  const base = path.split("/").pop()!.toLowerCase();
  if (BY_NAME[base]) return BY_NAME[base];
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  const lang = BY_EXT[ext];
  return lang && Prism.languages[lang] ? lang : null;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Highlight a single line to HTML. Lines longer than 2000 chars are left plain for speed. */
export function highlightLine(line: string, lang: string | null): string {
  if (!lang || line.length > 2000) return escape(line);
  return Prism.highlight(line, Prism.languages[lang], lang);
}
