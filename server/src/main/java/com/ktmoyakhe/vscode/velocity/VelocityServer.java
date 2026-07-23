package com.ktmoyakhe.vscode.velocity;

import com.ktmoyakhe.vscode.velocity.handler.HealthHandler;
import com.ktmoyakhe.vscode.velocity.handler.RenderHandler;
import com.ktmoyakhe.vscode.velocity.handler.ShutdownHandler;
import com.ktmoyakhe.vscode.velocity.introspection.CustomUberspect;
import com.sun.net.httpserver.HttpServer;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.velocity.app.VelocityEngine;
import org.apache.velocity.runtime.RuntimeConstants;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.Properties;

/**
 * HTTP server for rendering Apache Velocity templates with JavaScript mock support.
 */
public class VelocityServer {
    private static final Logger logger = LogManager.getLogger(VelocityServer.class);
    private static final int PORT = 9876;
    private static final String VERSION = "1.0.0";

    public static void main(String[] args) throws IOException {
        logger.info("Starting Velocity Server v{}...", VERSION);
        
        // Initialize Velocity Engine
        VelocityEngine velocityEngine = new VelocityEngine();
        Properties props = new Properties();
        props.setProperty(RuntimeConstants.RUNTIME_LOG_NAME, "velocity");
        props.setProperty(RuntimeConstants.RESOURCE_LOADERS, "file");
        props.setProperty(RuntimeConstants.FILE_RESOURCE_LOADER_PATH, "");
        props.setProperty(RuntimeConstants.FILE_RESOURCE_LOADER_CACHE, "false");
        
        // Use custom Uberspect for dynamic method resolution
        props.setProperty(RuntimeConstants.UBERSPECT_CLASSNAME, CustomUberspect.class.getName());
        
        velocityEngine.init(props);

        // Create HTTP Server
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/render", new RenderHandler(velocityEngine));
        server.createContext("/health", new HealthHandler());
        server.createContext("/shutdown", new ShutdownHandler(server));
        server.setExecutor(null);
        server.start();

        // Output to stdout for Node.js detection (logger may be NOP)
        System.out.println("Velocity Server started on port " + PORT);
        
        logger.info("Velocity Server started on port {}", PORT);
        logger.info("Endpoints:");
        logger.info("  POST /render - Render Velocity templates");
        logger.info("  GET /health - Health check");
        logger.info("  POST /shutdown - Graceful shutdown");
    }
}
