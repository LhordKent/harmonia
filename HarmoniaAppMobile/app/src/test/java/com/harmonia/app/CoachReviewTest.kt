package com.harmonia.app

import com.google.firebase.Timestamp
import com.harmonia.app.data.sync.CoachReview
import org.junit.Assert.*
import org.junit.Test

class CoachReviewTest {
    private fun review() = mapOf<String, Any?>(
        "verdictStatus" to "reviewed", "coachVerdict" to "Good stability",
        "coachFeedback" to "Keep the vowel steady.", "reviewedBy" to "coach1",
        "reviewedAt" to Timestamp(1700000000, 0), "coachPitchScore" to 82.0, "coachToneScore" to 78.0
    )
    @Test fun readsTheCoachReviewWithoutUsingMachineScores() {
        val parsed = CoachReview.from(review() + mapOf("accuracyScore" to 12, "toneScore" to 20))!!
        assertEquals(82f, parsed.pitch); assertEquals(78f, parsed.tone)
        assertEquals("Keep the vowel steady.", parsed.feedback)
        assertEquals(1700000000000L, parsed.reviewedAt)
    }
    @Test fun confirmationDoesNotInventCorrectedScores() {
        val parsed = CoachReview.from(review() + mapOf("coachPitchScore" to null, "coachToneScore" to null))!!
        assertNull(parsed.pitch); assertNull(parsed.tone)
    }
    @Test fun ignoresIncompleteUnreviewedOrMalformedReviews() {
        listOf(
            mapOf("verdictStatus" to "aiPending"), mapOf("reviewedBy" to null), mapOf("reviewedAt" to null),
            mapOf("coachPitchScore" to 101), mapOf("coachToneScore" to null), mapOf("coachVerdict" to "fake approval")
        ).forEach { assertNull(CoachReview.from(review() + it)) }
    }
}
