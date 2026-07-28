import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AdminAuth } from '../../../common/auth/decorators.js';
import { InvariantsService } from '../invariants.service.js';

@ApiTags('admin-invariants')
@AdminAuth()
@Controller('admin/invariants')
export class InvariantsController {
  constructor(private readonly invariants: InvariantsService) {}

  @Get()
  async list() {
    const results = await this.invariants.check();
    return {
      results,
      clean: results.every((r) => r.count === 0),
      checked_at: new Date().toISOString(),
    };
  }
}
