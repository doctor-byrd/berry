import { Controller, Get, Param, Post, Body, Delete, Patch, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { DeleteResult } from 'typeorm';
import { Paginate, type PaginateQuery, Paginated } from 'nestjs-paginate';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateUserDto, UpdateUserDto, User, UserRoles } from '@project/shared-types';


@Controller('users')
export class UsersController {
    constructor(private usersService: UsersService) {}

    @Get()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRoles.ADMIN)
    findAll(@Paginate() query: PaginateQuery): Promise <Paginated<User>> {
        return this.usersService.findAll(query);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findOne(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
        return this.usersService.findOne(id);
    }

    @Post()
    create(@Body() newUser: CreateUserDto): Promise<User> {
        return this.usersService.create(newUser);
    }

    @Patch(':id')
    update(@Param('id', ParseUUIDPipe) id: string, @Body() updatedUser: UpdateUserDto): Promise<User> {
        return this.usersService.update(id, updatedUser);
    }

    @Delete(':id')
    remove(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
        return this.usersService.remove(id);
    }

    @Patch(':id/restore')
    restore(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
        return this.usersService.restore(id);
    }

    @Delete(':id/hard')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRoles.ADMIN)
    hardDelete(@Param('id', ParseUUIDPipe) id: string): Promise<DeleteResult> {
        return this.usersService.delete(id);
    }
}