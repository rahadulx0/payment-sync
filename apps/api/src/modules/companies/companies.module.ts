import { Module } from '@nestjs/common';

import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompanySettingsService } from './company-settings.service.js';
import { OnboardingPacketService } from './onboarding-packet.service.js';

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanySettingsService, OnboardingPacketService],
  exports: [CompaniesService, CompanySettingsService],
})
export class CompaniesModule {}
