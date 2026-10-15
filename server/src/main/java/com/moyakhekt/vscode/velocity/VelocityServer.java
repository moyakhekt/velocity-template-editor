package com.moyakhekt.vscode.velocity;

import com.moyakhekt.vscode.velocity.handler.AuthFilter;
import com.moyakhekt.vscode.velocity.handler.HealthHandler;
import com.moyakhekt.vscode.velocity.handler.RenderHandler;
import com.moyakhekt.vscode.velocity.handler.ShutdownHandler;
import com.moyakhekt.vscode.velocity.introspection.CustomUberspect;
import com.sun.net.httpserver.HttpServer;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.velocity.app.VelocityEngine;
import org.apache.velocity.runtime.RuntimeConstants;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Properties;

/**
 * HTTP server for rendering Apache Velocity templates with JavaScript mock support.
 */
public class VelocityServer {
    private static final Logger logger = LogManager.getLogger(VelocityServer.class);
    // 0 picks a free port, reported on stdout; overridable (-Dvelocity.port=...) for manual testing
    private static final int PORT = Integer.getInteger("velocity.port", 0);
    // Set by the extension when it launches the server; every request must send it back
    private static final String TOKEN_ENV = "VELOCITY_SERVER_TOKEN";
    private static final String VERSION = "1.0.0";

    public static void main(String[] args) throws IOException {
        logger.info("Starting Velocity Server v{}...", VERSION);
        
        // Initialize Velocity Engine
        var velocityEngine = new VelocityEngine();
        var props = new Properties();
        props.setProperty(RuntimeConstants.RUNTIME_LOG_NAME, "velocity");
        props.setProperty(RuntimeConstants.RESOURCE_LOADERS, "file");
        props.setProperty(RuntimeConstants.FILE_RESOURCE_LOADER_PATH, "");
        props.setProperty(RuntimeConstants.FILE_RESOURCE_LOADER_CACHE, "false");
        
        // Use custom Uberspect for dynamic method resolution
        props.setProperty(RuntimeConstants.UBERSPECT_CLASSNAME, CustomUberspect.class.getName());
        
        velocityEngine.init(props);

        String token = System.getenv(TOKEN_ENV);
        if (token == null || token.isBlank()) {
            // Started by hand: make a token so the server is never open to anyone
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            token = HexFormat.of().formatHex(bytes);
            System.err.println("No " + TOKEN_ENV + " set; send this in the " + AuthFilter.TOKEN_HEADER + " header: " + token);
        }
        var auth = new AuthFilter(token);

        // Loopback only: rendering runs mock JavaScript, so the server must not be reachable from the network
        var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), PORT), 0);
        server.createContext("/render", new RenderHandler(velocityEngine)).getFilters().add(auth);
        server.createContext("/health", new HealthHandler()).getFilters().add(auth);
        server.createContext("/shutdown", new ShutdownHandler(server)).getFilters().add(auth);
        server.setExecutor(null);
        server.start();
        int port = server.getAddress().getPort();

        // stdout is the handshake channel to the extension: this one JSON line says the
        // server is ready and where. Everything human-readable goes to stderr (log4j2.xml).
        System.out.println("{\"event\":\"ready\",\"port\":" + port + "}");
        System.out.flush();

        logger.info("Velocity Server started on port {}", port);
        logger.info("Endpoints:");
        logger.info("  POST /render - Render Velocity templates");
        logger.info("  GET /health - Health check");
        logger.info("  POST /shutdown - Graceful shutdown");
    }
}
