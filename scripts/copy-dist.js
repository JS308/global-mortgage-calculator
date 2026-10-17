const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
fs.mkdirSync(dist, { recursive: true });

["index.html", "app.js", "mortgage.js", "styles.css", "baidu_verify_codeva-9aofZiE323.html"].forEach((file) => {
  fs.copyFileSync(path.join(__dirname, "..", file), path.join(dist, file));
});
