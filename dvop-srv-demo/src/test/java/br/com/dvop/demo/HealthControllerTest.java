package br.com.dvop.demo;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class HealthControllerTest {

    @Test
    void livenessRespondeUp() {
        assertThat(new HealthController().liveness())
                .isEqualTo(Map.of("status", "UP"));
    }
}
