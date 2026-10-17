const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
fs.mkdirSync(dist, { recursive: true });

["index.html", "about.html", "privacy.html", "app.js", "mortgage.js", "styles.css", "ads.txt", "baidu_verify_codeva-9aofZiE323.html"].forEach((file) => {
  fs.copyFileSync(path.join(__dirname, "..", file), path.join(dist, file));
});
fs.cpSync(path.join(__dirname, "..", "vendor"), path.join(dist, "vendor"), { recursive: true });
