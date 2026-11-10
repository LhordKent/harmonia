package com.harmonia.app.data.repository

import com.harmonia.app.data.local.dao.NotificationDao
import com.harmonia.app.data.local.entity.NotificationEntity
import kotlinx.coroutines.flow.Flow

class NotificationRepository(
    private val notificationDao: NotificationDao
) {
    fun observeNotifications(studentId: String): Flow<List<NotificationEntity>> {
        return notificationDao.observeNotifications(studentId)
    }

    fun observeUnreadCount(studentId: String): Flow<Int> {
        return notificationDao.observeUnreadCount(studentId)
    }

    suspend fun markAsRead(id: String) {
        notificationDao.markAsRead(id)
    }

    suspend fun markAllAsRead(studentId: String) {
        notificationDao.markAllAsRead(studentId)
    }

    suspend fun sendNotification(studentId: String, title: String, message: String) {
        notificationDao.insert(
            NotificationEntity(
                id = "notif_" + System.currentTimeMillis(),
                studentId = studentId,
                title = title,
                message = message,
                isRead = false,
                sentAt = System.currentTimeMillis()
            )
        )
    }
}
