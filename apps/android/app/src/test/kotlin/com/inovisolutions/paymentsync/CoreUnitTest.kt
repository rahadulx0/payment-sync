package com.inovisolutions.paymentsync

import com.google.common.truth.Truth.assertThat
import com.inovisolutions.paymentsync.data.sms.AddressAllowlist
import com.inovisolutions.paymentsync.data.sms.MessageHash
import com.inovisolutions.paymentsync.data.sms.Normalize
import com.inovisolutions.paymentsync.data.sms.PduAssembler
import com.inovisolutions.paymentsync.domain.model.Money
import org.junit.Test

class MoneyTest {
    @Test fun `parses and renders without floats`() {
        assertThat(Money.fromDecimalString("1,500.00").paisa).isEqualTo(150000L)
        assertThat(Money.fromDecimalString("Tk 1250").toDisplayString()).isEqualTo("1250.00")
        assertThat(Money.fromDecimalString("7,656.00").toDisplayString()).isEqualTo("7656.00")
        assertThat(Money.fromDecimalString("০").toDisplayString()).isEqualTo("0.00") // Bengali zero
    }

    @Test fun `rejects ambiguous amounts`() {
        assertThat(Money.fromDecimalStringOrNull("1.005")).isNull()
        assertThat(Money.fromDecimalStringOrNull("abc")).isNull()
    }
}

class NormalizeTest {
    @Test fun `msisdn to +8801 form`() {
        assertThat(Normalize.normalizeMsisdn("01759584276")).isEqualTo("+8801759584276")
        assertThat(Normalize.normalizeMsisdn("8801712345678")).isEqualTo("+8801712345678")
        assertThat(Normalize.normalizeMsisdn("12345")).isNull()
    }

    @Test fun `trxId uppercased, alphanumeric, not all-digit`() {
        assertThat(Normalize.normalizeTrxId("da56rp7n7c")).isEqualTo("DA56RP7N7C")
        assertThat(Normalize.normalizeTrxId("12345")).isNull()
        assertThat(Normalize.normalizeTrxId("AB1")).isNull()
    }

    @Test fun `timestamp parses Dhaka local to UTC ISO`() {
        val iso = Normalize.normalizeTimestamp("05/01/2026 16:55", listOf("dd/MM/yyyy HH:mm"), 1_900_000_000_000L)
        assertThat(iso).isEqualTo("2026-01-05T10:55:00.000Z") // 16:55 Dhaka = 10:55 UTC
    }

    @Test fun `body normalised NFKC, whitespace collapsed`() {
        assertThat(Normalize.normalizeBody("  a   b\n c ")).isEqualTo("a b c")
    }
}

class MessageHashTest {
    @Test fun `client hash is deterministic and whitespace-insensitive in body`() {
        val a = MessageHash.clientMsgHash("COMP1", "bKash", "Cash In  Tk 10", 1000L)
        val b = MessageHash.clientMsgHash("COMP1", "bKash", "Cash In Tk 10", 1000L)
        assertThat(a).isEqualTo(b) // body normalised before hashing
        assertThat(a).hasLength(64)
        // Golden vector pins the recipe across app versions.
        assertThat(MessageHash.clientMsgHash("COMP1", "bKash", "x", 0L))
            .isEqualTo(sha256Hex("COMP1|bKash|x|0"))
    }

    private fun sha256Hex(s: String): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}

class AddressAllowlistTest {
    private val allow = AddressAllowlist(listOf("bKash", "BKASH", "16247"))

    @Test fun `exact match, case-insensitive`() {
        assertThat(allow.matches("bKash")).isTrue()
        assertThat(allow.matches("BKASH")).isTrue()
    }

    @Test fun `substring spoof is dropped`() {
        assertThat(allow.matches("bKash-Promo")).isFalse()
        assertThat(allow.matches("info-bKash")).isFalse()
    }

    @Test fun `numeric shortcode with +880 prefix still matches`() {
        assertThat(allow.matches("+88016247")).isTrue()
        assertThat(allow.matches("16247")).isTrue()
    }

    @Test fun `unknown address fails closed`() {
        assertThat(allow.matches("01712345678")).isFalse()
        assertThat(allow.matches("Nagad")).isFalse()
    }
}

class PduAssemblerTest {
    @Test fun `reassembles multipart in order, order-independent input`() {
        val parts = listOf(PduAssembler.Part(1, "world"), PduAssembler.Part(0, "hello "))
        assertThat(PduAssembler.assemble(parts)).isEqualTo("hello world")
    }
}
