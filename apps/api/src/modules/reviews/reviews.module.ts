import { Module } from '@nestjs/common';

import { ResolveService } from './resolve.service.js';
import { ReviewsController } from './reviews.controller.js';

@Module({
  controllers: [ReviewsController],
  providers: [ResolveService],
})
export class ReviewsModule {}
