import logger from "../logger.mjs";

class QueueMonitor {
  constructor() {
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      currentQueueSize: 0,
      averageProcessingTime: 0,
      lastProcessedAt: null,
      uptime: Date.now()
    };
    this.processingTimes = [];
    this.maxProcessingTimeHistory = 100; // Keep last 100 processing times
  }

  recordProcessingStart(jobId) {
    logger.debug({ jobId }, "Job processing started");
    return {
      jobId,
      startTime: Date.now()
    };
  }

  recordProcessingEnd(jobInfo, success = true, error = null) {
    const endTime = Date.now();
    const processingTime = endTime - jobInfo.startTime;
    
    // Update metrics
    this.metrics.totalProcessed++;
    this.metrics.lastProcessedAt = new Date().toISOString();
    
    if (!success) {
      this.metrics.totalFailed++;
      logger.error({
        jobId: jobInfo.jobId,
        processingTime,
        error: error?.message
      }, "Job processing failed");
    } else {
      logger.debug({
        jobId: jobInfo.jobId,
        processingTime
      }, "Job processing completed successfully");
    }

    // Update processing time metrics
    this.processingTimes.push(processingTime);
    if (this.processingTimes.length > this.maxProcessingTimeHistory) {
      this.processingTimes.shift();
    }
    
    // Calculate average processing time
    this.metrics.averageProcessingTime = this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;

    return {
      success,
      processingTime,
      totalProcessed: this.metrics.totalProcessed
    };
  }

  updateQueueSize(size) {
    this.metrics.currentQueueSize = size;
  }

  getMetrics() {
    const uptime = Date.now() - this.metrics.uptime;
    const successRate = this.metrics.totalProcessed > 0 
      ? ((this.metrics.totalProcessed - this.metrics.totalFailed) / this.metrics.totalProcessed * 100).toFixed(2)
      : 0;

    return {
      ...this.metrics,
      uptime: `${Math.floor(uptime / 1000)}s`,
      successRate: `${successRate}%`,
      averageProcessingTime: Math.round(this.metrics.averageProcessingTime),
      recentProcessingTimes: this.processingTimes.slice(-10) // Last 10 processing times
    };
  }

  getHealthStatus() {
    const failureRate = this.metrics.totalProcessed > 0 
      ? (this.metrics.totalFailed / this.metrics.totalProcessed * 100)
      : 0;

    let status = 'healthy';
    let issues = [];

    // Check for high failure rate
    if (failureRate > 20) {
      status = 'unhealthy';
      issues.push(`High failure rate: ${failureRate.toFixed(2)}%`);
    } else if (failureRate > 10) {
      status = 'degraded';
      issues.push(`Elevated failure rate: ${failureRate.toFixed(2)}%`);
    }

    // Check for large queue size
    if (this.metrics.currentQueueSize > 1000) {
      status = status === 'healthy' ? 'degraded' : status;
      issues.push(`Large queue size: ${this.metrics.currentQueueSize}`);
    }

    // Check for slow processing
    if (this.metrics.averageProcessingTime > 10000) { // 10 seconds
      status = status === 'healthy' ? 'degraded' : status;
      issues.push(`Slow processing: ${this.metrics.averageProcessingTime}ms avg`);
    }

    // Check if recently processed anything
    if (this.metrics.lastProcessedAt) {
      const timeSinceLastProcess = Date.now() - new Date(this.metrics.lastProcessedAt).getTime();
      if (timeSinceLastProcess > 300000 && this.metrics.currentQueueSize > 0) { // 5 minutes
        status = 'degraded';
        issues.push('No recent processing activity');
      }
    }

    return {
      status,
      issues,
      metrics: {
        failureRate: `${failureRate.toFixed(2)}%`,
        queueSize: this.metrics.currentQueueSize,
        averageProcessingTime: `${Math.round(this.metrics.averageProcessingTime)}ms`,
        totalProcessed: this.metrics.totalProcessed
      }
    };
  }

  reset() {
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      currentQueueSize: 0,
      averageProcessingTime: 0,
      lastProcessedAt: null,
      uptime: Date.now()
    };
    this.processingTimes = [];
    logger.info("Queue monitor metrics reset");
  }
}

// Export singleton instance
export const queueMonitor = new QueueMonitor();

export default queueMonitor;
