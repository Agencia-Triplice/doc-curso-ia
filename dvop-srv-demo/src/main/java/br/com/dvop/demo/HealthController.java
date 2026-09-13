package br.com.dvop.demo;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @GetMapping("/health/liveness")
    public Map<String, String> liveness() {
        return Map.of("status", "UP");
    }
}
