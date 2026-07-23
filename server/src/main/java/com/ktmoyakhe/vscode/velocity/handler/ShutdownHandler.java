package com.ktmoyakhe.vscode.velocity.handler;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class ShutdownHandler implements HttpHandler {
    private static final Logger logger = LogManager.getLogger(ShutdownHandler.class);
    private final HttpServer server;

    public ShutdownHandler(HttpServer server) {
        this.server = server;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String response = "{\"status\":\"shutting down\"}";
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }

        // Shutdown server after response
        new Thread(() -> {
            try {
                Thread.sleep(500);
                server.stop(0);
                logger.info("Server stopped");
                System.exit(0);
            } catch (InterruptedException e) {
                logger.error("Error during shutdown", e);
            }
        }).start();
    }
}
