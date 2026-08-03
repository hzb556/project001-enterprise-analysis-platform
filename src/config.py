"""应用配置"""
import os
import secrets


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_hex(32))
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///app.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEBUG = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'


class DevelopmentConfig(Config):
    DEBUG = True
    SECRET_KEY = 'dev-secret-key-change-in-production'


class ProductionConfig(Config):
    DEBUG = False
