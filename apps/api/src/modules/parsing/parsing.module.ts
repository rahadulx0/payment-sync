import { Global, Module } from '@nestjs/common';

import { ParserService } from './parser.service.js';
import { ParsingController } from './parsing.controller.js';
import { RuleRepository } from './rule.repository.js';

@Global()
@Module({
  controllers: [ParsingController],
  providers: [RuleRepository, ParserService],
  exports: [RuleRepository, ParserService],
})
export class ParsingModule {}
