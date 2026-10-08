from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='training'),
    path('api/state/', views.state),
    path('api/activities/', views.save_activity),
    path('api/activities/<int:pk>/', views.activity_detail),
    path('api/import/', views.import_tcx),
    path('api/profile/', views.profile),
    path('api/export/', views.export_csv),
]
