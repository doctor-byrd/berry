import * as bcrypt from 'bcryptjs';
import { paginate, PaginateQuery, Paginated } from 'nestjs-paginate';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeleteResult, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto, UpdateUserDto, UserRoles, User } from '@project/shared-types';
import { EncryptionOptions, PaginationOptions } from '../common/general';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private userRepository: Repository<User>) {}

  async create(newUser: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(newUser.password, EncryptionOptions.SALT_ROUNDS);
    const user = this.userRepository.create({
      ...newUser,
      passwordHash: hashedPassword,
      role: UserRoles.USER
    });
    return this.userRepository.save(user);
  }

  async findAll(query: PaginateQuery): Promise<Paginated<User>> {
    return paginate(query, this.userRepository, {
      sortableColumns: ['id', 'email', 'createdAt'],
      nullSort: 'last',
      defaultSortBy: [['createdAt', 'DESC']],
      searchableColumns: ['email'],
      maxLimit: PaginationOptions.DEFAULT_MAX_LIMIT as number,
      defaultLimit: PaginationOptions.DEFAULT_LIMIT as number,
    });
  }

  async findDeleted(query: PaginateQuery): Promise<Paginated<User>> {
    return paginate(query, this.userRepository, {
      sortableColumns: ['id', 'email', 'deletedAt'],
      nullSort: 'last',
      defaultSortBy: [['deletedAt', 'DESC']],
      searchableColumns: ['email'],
      maxLimit: PaginationOptions.DEFAULT_MAX_LIMIT as number,
      defaultLimit: PaginationOptions.DEFAULT_LIMIT as number,
      withDeleted: true,
    });
  }

  async findByRole(role: UserRoles, query: PaginateQuery): Promise<Paginated<User>> {
    return paginate(query, this.userRepository, {
      sortableColumns: ['id', 'email', 'createdAt'],
      nullSort: 'last',
      defaultSortBy: [['createdAt', 'DESC']],
      searchableColumns: ['email'],
      maxLimit: PaginationOptions.DEFAULT_MAX_LIMIT as number,
      defaultLimit: PaginationOptions.DEFAULT_LIMIT as number,
      filterableColumns: {
        role: true,
      },
      where: {
        role: role,
      }
    });
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ email });
    if(!user) throw new NotFoundException('User not found');
    return user
  }

  async changeRole(id: string, role: UserRoles): Promise<User> {
    const user = await this.findOne(id);
    user.role = role;
    return await this.userRepository.save(user);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.findOne(id);
    const hashedPassword = await bcrypt.hash(newPassword, EncryptionOptions.SALT_ROUNDS);
    user.passwordHash = hashedPassword;
    await this.userRepository.save(user);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOneBy({id});
    if(!user) throw new NotFoundException('User not found')
    return user;
  }

  async update(id: string, updatedUser: UpdateUserDto): Promise<User> {
    if(Object.keys(updatedUser).length === 0) {
      throw new BadRequestException('No valid fields provided for update');
    }
    
    const user = await this.findOne(id);

    if(updatedUser.password) {
      user.passwordHash = await bcrypt.hash(updatedUser.password, EncryptionOptions.SALT_ROUNDS);
    }

    const { password, ...rest } = updatedUser;
    Object.assign(user, rest);

    return await this.userRepository.save(user);
  }

  async remove(id: string): Promise<User> {
    const user = await this.findOne(id);
    return await this.userRepository.softRemove(user);
  }

  async restore(id: string): Promise<User> {
    const user = await this.findOneWithDeleted(id);
    return await this.userRepository.recover(user);
  }

  async findOneWithDeleted(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: {id}, withDeleted: true})
    if(!user) throw new NotFoundException('User not found');
    return user;
  }

  async delete(id: string): Promise<DeleteResult> {
    return await this.userRepository.delete(id);
  }
  
}
