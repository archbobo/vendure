import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import {
    CreateCountryInput,
    DeletionResponse,
    DeletionResult,
    UpdateCountryInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { Connection } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound } from '../../common/utils';
import { Address } from '../../entity';
import { CountryTranslation } from '../../entity/country/country-translation.entity';
import { Country } from '../../entity/country/country.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { getEntityOrThrow } from '../helpers/utils/get-entity-or-throw';
import { translateDeep } from '../helpers/utils/translate-entity';

import { ZoneService } from './zone.service';

@Injectable()
export class CountryService {
    constructor(
        @InjectConnection() private connection: Connection,
        private listQueryBuilder: ListQueryBuilder,
        private translatableSaver: TranslatableSaver,
        private zoneService: ZoneService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Country>,
    ): Promise<PaginatedList<Translated<Country>>> {
        return this.listQueryBuilder
            .build(Country, options)
            .getManyAndCount()
            .then(([countries, totalItems]) => {
                const items = countries.map(country => translateDeep(country, ctx.languageCode));
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(ctx: RequestContext, countryId: ID): Promise<Translated<Country> | undefined> {
        return this.connection
            .getRepository(Country)
            .findOne(countryId)
            .then(country => country && translateDeep(country, ctx.languageCode));
    }

    async findOneByCode(ctx: RequestContext, countryCode: string): Promise<Translated<Country>> {
        const country = await this.connection.getRepository(Country).findOne({
            where: {
                code: countryCode,
            },
        });
        if (!country) {
            throw new UserInputError('error.country-code-not-valid', { countryCode });
        }
        return translateDeep(country, ctx.languageCode);
    }

    async create(ctx: RequestContext, input: CreateCountryInput): Promise<Translated<Country>> {
        const country = await this.translatableSaver.create({
            input,
            entityType: Country,
            translationType: CountryTranslation,
        });
        await this.zoneService.updateZonesCache();
        return assertFound(this.findOne(ctx, country.id));
    }

    async update(ctx: RequestContext, input: UpdateCountryInput): Promise<Translated<Country>> {
        const country = await this.translatableSaver.update({
            input,
            entityType: Country,
            translationType: CountryTranslation,
        });
        await this.zoneService.updateZonesCache();
        return assertFound(this.findOne(ctx, country.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const country = await getEntityOrThrow(this.connection, Country, id);
        const addressesUsingCountry = await this.connection
            .getRepository(Address)
            .createQueryBuilder('address')
            .where('address.country = :id', { id })
            .getCount();

        if (0 < addressesUsingCountry) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.country-used-in-addresses', { count: addressesUsingCountry }),
            };
        } else {
            await this.zoneService.updateZonesCache();
            await this.connection.getRepository(Country).remove(country);
            return {
                result: DeletionResult.DELETED,
                message: '',
            };
        }
    }
}
