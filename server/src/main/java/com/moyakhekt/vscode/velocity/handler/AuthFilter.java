package com.moyakhekt.vscode.velocity.handler;

import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Rejects requests that don't carry the token the extension started the server with.
 * Rendering runs mock JavaScript, so only the extension that launched this server may
 * call it; web pages in a browser can't read or set the header without the token.
 */
public class AuthFilter extends Filter {
    public static final String TOKEN_HEADER = "X-Velocity-Token";
    private final byte[] token;

    public AuthFilter(String token) {
        this.token = token.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public void doFilter(HttpExchange exchange, Chain chain) throws IOException {
        String supplied = exchange.getRequestHeaders().getFirst(TOKEN_HEADER);
        if (supplied == null || !MessageDigest.isEqual(token, supplied.getBytes(StandardCharsets.UTF_8))) {
            exchange.sendResponseHeaders(401, -1);
            exchange.close();
            return;
        }
        chain.doFilter(exchange);
    }

    @Override
    public String description() {
        return "Requires the " + TOKEN_HEADER + " header";
    }
}
