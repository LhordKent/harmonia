package com.harmonia.app

import com.harmonia.app.data.sync.SupabaseAudioStore
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SupabaseAudioStoreTest {
    @Test fun acceptsOnlyTheSupabaseAudioFunction() {
        assertTrue(SupabaseAudioStore.validEndpoint("https://example.supabase.co/functions/v1/audio"))
        listOf(
            "http://example.supabase.co/functions/v1/audio",
            "https://example.supabase.co.evil.test/functions/v1/audio",
            "https://evil.test/functions/v1/audio",
            "https://example.supabase.co/functions/v1/other",
            "https://example.supabase.co/functions/v1/audio?redirect=evil",
            "https://user:pass@example.supabase.co/functions/v1/audio",
            "https://example.supabase.co:8443/functions/v1/audio",
            "not a URL"
        ).forEach { assertFalse(it, SupabaseAudioStore.validEndpoint(it)) }
    }
}
