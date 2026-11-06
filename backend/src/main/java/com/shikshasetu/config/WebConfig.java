package com.shikshasetu.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import com.shikshasetu.portal.PortalSecurityInterceptor;
import org.springframework.beans.factory.annotation.Value;
import java.util.Arrays;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final PortalSecurityInterceptor securityInterceptor;
    @Value("${shikshasetu.cors.allowed-origin-patterns:http://localhost:*,http://127.0.0.1:*}")
    private String allowedOriginPatterns;
    public WebConfig(PortalSecurityInterceptor securityInterceptor) { this.securityInterceptor = securityInterceptor; }
    @Override public void addInterceptors(org.springframework.web.servlet.config.annotation.InterceptorRegistry registry) { registry.addInterceptor(securityInterceptor).addPathPatterns("/api/**"); }
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            // Keep the production allowlist explicit; do not use a universal wildcard.
            .allowedOriginPatterns(Arrays.stream(allowedOriginPatterns.split(","))
                .map(String::trim).filter(value -> !value.isEmpty()).toArray(String[]::new))
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("Content-Type", "Accept", "X-Requested-With", "Authorization")
            .allowCredentials(false)
            .maxAge(3600);
    }
}
