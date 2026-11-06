package com.shikshasetu.portal;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PortalPasswordHasherTest {
    @Test
    void hashesAreSaltedAndOnlyMatchTheOriginalPassword() {
        String first = PortalPasswordHasher.hash("a long test password");
        String second = PortalPasswordHasher.hash("a long test password");
        assertNotEquals(first, second, "A fresh salt should produce a different hash");
        assertTrue(PortalPasswordHasher.matches("a long test password", first));
        assertFalse(PortalPasswordHasher.matches("another password", first));
        assertFalse(PortalPasswordHasher.matches("a long test password", "not-a-hash"));
    }
}
