const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<html><body><h1>Hello World</h1></body></html>");
});

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  console.log(`Hello World server running on port ${PORT}`);
});
