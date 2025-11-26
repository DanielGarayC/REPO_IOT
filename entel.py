from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.request
import ssl
import json

class SimpleHTTPRequestHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # 解析请求路径
        url = "https://apigee-prodha.entel.pe/auth/oauth/v2/token"
        print("request url: " + url)

        # 读取请求body
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        print("request body: " + post_data.decode('utf-8'))

        try:
            # 创建一个不验证SSL证书的上下文
            context = ssl.create_unverified_context()

            # 创建POST请求
            request = urllib.request.Request(url, data=post_data)
            request.add_header('Host', self.headers.get('Host'))
            request.add_header('Content-Type', self.headers.get('Content-Type'))

            # 发起请求到目标URL
            response = urllib.request.urlopen(request, context=context)

            # 读取响应内容
            response_data = response.read().decode('utf-8')
            json_resp_data = json.loads(response_data)
            json_resp_data['scope'] = 'oob'
            response_data = json.dumps(json_resp_data)
            print("response body: " + response_data)

            # 将响应发送给客户端
            self.send_response(response.getcode())
            self.send_header('Content-Type', response.headers.get('Content-Type'))
            self.end_headers()
            self.wfile.write(response_data.encode('utf-8'))
        except Exception as e:
            print(e)
            self.send_error(500, '{}')

def run(server_class=HTTPServer, handler_class=SimpleHTTPRequestHandler, port=8080):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print('Starting httpd server on port {}...'.format(port))
    httpd.serve_forever()

if __name__ == '_main_':
    run()